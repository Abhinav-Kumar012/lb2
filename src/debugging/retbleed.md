# Retbleed

Retbleed is a class of speculative execution vulnerabilities that exploit
**return instructions** to leak data across security boundaries.  It was
disclosed in July 2022 by researchers at ETH Zurich and affects AMD and Intel
processors.  Retbleed is particularly significant because it bypasses the
mitigations put in place for Spectre-BHB and earlier Spectre variants.

---

## 1. Background: Speculative Execution and Returns

Modern CPUs execute instructions **speculatively** — they guess the outcome
of branches and begin executing the predicted path before the result is
known.  If the guess is wrong, the speculative results are discarded, but
side effects on the cache remain, enabling information leakage.

### 1.1 Branch Prediction

There are two main branch types:

| Type | Predictor | Speculation Target |
|---|---|---|
| **Conditional branch** | Conditional predictor | `if/else` paths |
| **Indirect branch** | Branch Target Buffer (BTB) | `call *reg`, `jmp *reg` |
| **Return** | Return Stack Buffer (RSB) / RAS | Address after `call` |

### 1.2 Returns Are Special

`ret` instructions use the **Return Stack Buffer** (RSB, also called RAS —
Return Address Stack) to predict the return target.  The RSB is a small
hardware stack that records return addresses as `call` instructions execute.

---

## 2. The Retbleed Attack

### 2.1 Core Mechanism

```
Attacker process:
  1. Fills the RSB with attacker-controlled addresses
  2. Triggers a context switch to the victim (kernel or another process)

Victim process:
  3. Executes a 'ret' instruction
  4. CPU speculatively jumps to the attacker's RSB entry
  5. Speculative code accesses secret data
  6. Secret data leaves a cache trace

Attacker process:
  7. Re-gains execution
  8. Measures cache timing to recover the secret
```

### 2.2 Why RSB Poisoning Works

RSBs are **per-core**, not per-process.  A context switch does not
automatically clear the RSB (on most CPUs).  An attacker can pre-fill the
RSB with gadget addresses before yielding the CPU.

### 2.3 Gadgets

The attacker needs **gadgets** — short code sequences ending in `ret` that:

1. Load a secret value into a register.
2. Use that register as an address for a memory access.
3. The memory access modifies the cache.

Example kernel gadget (simplified):

```asm
mov rax, [rdi]       ; load secret
mov rbx, [rax * 8]   ; cache-dependent access
ret
```

---

## 3. Affected Processors

### 3.1 AMD

| Family | Vulnerable | Notes |
|---|---|---|
| Zen 1 (Family 17h) | **Yes** | AMD recommends IBPB on every kernel entry |
| Zen 1+ (Family 17h, rev A) | **Yes** | Same as Zen 1 |
| Zen 2 (Family 18h) | **Yes** | IBPB recommended |
| Zen 3+ | **No** (hardware mitigation) | IBRS/SBRS present |

### 3.2 Intel

| Generation | Vulnerable | Notes |
|---|---|---|
| Pre-Skylake | **Yes** (limited) | Retpoline works |
| Skylake+ | **Yes** | Retpoline insufficient; needs IBRS |
| Alder Lake+ | **No** (hardware) | IBRS/eIBRS effective |

### 3.3 Why Retpoline Doesn't Work for AMD

**Retpoline** (return trampoline) was the original Spectre-v2 mitigation for
indirect branches.  It replaces indirect jumps with a `ret`-based sequence.
On AMD CPUs, this actually **makes things worse** because `ret` is the
vulnerable instruction — retpoline turns indirect branch attacks into return
attacks.

---

## 4. Mitigations

### 4.1 Retpoline (Intel Pre-Skylake)

For older Intel CPUs where `ret` is not vulnerable:

```asm
; Retpoline gadget
call .setup
.pause: lfence
       jmp .pause
.setup:
       mov [rsp], %rdi   ; target address
       ret                ; jumps to %rdi, but RSB is safe
```

The `lfence` loop prevents speculative execution past the `call`.

### 4.2 IBRS / eIBRS (Intel)

**Indirect Branch Restricted Speculation** (IBRS) is a hardware feature
(MSR bit) that restricts speculation:

* **IBRS** (v1): requires MSR write on every kernel entry (slow).
* **eIBRS** (enhanced, v2): automatically restricts speculation when
  entering ring 0.  Much faster.

On CPUs with eIBRS, retpoline is disabled and the hardware handles it.

### 4.3 IBPB (AMD)

**Indirect Branch Prediction Barrier** (IBPB) flushes the entire branch
prediction state on context switch.  It is expensive (~2-5 µs per switch)
but effective.

```c
#define SPEC_CTRL_IBPB  (1 << 0)

static inline void indirect_branch_prediction_barrier(void)
{
    wrmsrl(MSR_IA32_PRED_CMD, SPEC_CTRL_IBPB);
}
```

### 4.4 RSB Fill (All CPUs)

On context switch, fill the RSB with safe addresses (the kernel's own
`int3` or `hlt` handlers):

```c
static void __always_inline fill_rsb(void)
{
    asm volatile (
        ".rept 32\n\t"
        "call .+4\n\t"    /* push a safe address onto RSB */
        ".rept 5\n\t"
        "nop\n\t"
        ".endr\n\t"
        "add $4, %%rsp\n\t"
        ".endr\n\t"
        : : : "memory"
    );
}
```

### 4.5 Combined Strategy (Linux 5.19+)

The kernel chooses the mitigation at boot based on the CPU:

| CPU | Mitigation |
|---|---|
| AMD Zen 1/2 | IBPB on kernel entry + RSB fill |
| AMD Zen 3+ | None needed (hardware) |
| Intel pre-Skylake | Retpoline + RSB fill |
| Intel Skylake+ | eIBRS |
| Hygon (AMD derivative) | IBPB |

---

## 5. Kernel Configuration

### 5.1 Boot Parameter

```
retbleed=<mode>
```

| Mode | Effect |
|---|---|
| `auto` | Kernel chooses (default) |
| `off` | Disable mitigation (dangerous) |
| `auto,nosmt` | Like auto, but also disable SMT |
| `ibpb` | Force IBPB on AMD |
| `ibrs` | Force IBRS on Intel |
| `retpoline` | Force retpoline |
| `unret` | Force unreturn (RSB stuffing) |

### 5.2 Checking Current Mitigation

```bash
# Check CPU vulnerability status
grep . /sys/devices/system/cpu/vulnerabilities/retbleed

# Output examples:
# "Mitigation: untrained return thunk; IBPB disabled; PBRSB-eIBRS Not affected"
# "Mitigation: IBRS; IBPB conditional; RSB filling; PBRSB-eIBRS Not affected"
```

### 5.3 Compile-Time Options

```
CONFIG_RETPOLINE=y           # Retpoline support
CONFIG_MITIGATION_RETPOLINE=y # Enable retpoline (5.19+ naming)
CONFIG_CPU_MITIGATIONS=y     # General mitigation framework
```

---

## 6. Performance Impact

| Mitigation | Overhead | Workload |
|---|---|---|
| IBPB (AMD) | 2-5% | General computing |
| IBPB (AMD, syscalls) | 5-15% | Syscall-heavy workloads |
| eIBRS (Intel) | 1-3% | General computing |
| Retpoline | 2-5% | Branch-heavy code |
| SMT disabled | 20-40% | Multi-threaded workloads |

### 6.1 Measuring Overhead

```bash
# Before mitigation
perf stat -e instructions,cycles -- ./workload

# With retbleed=off (benchmark only, not for production)
# Compare IPC (instructions per cycle) and wall time
```

### 6.2 Reducing Overhead

* **Use CPUs with hardware mitigations** (Zen 3+, Alder Lake+).
* **Gaming/desktop**: `retbleed=off` may be acceptable (no multi-tenant risk).
* **Server/cloud**: always enable full mitigations.

---

## 7. Related Vulnerabilities

| CVE | Name | Mechanism |
|---|---|---|
| CVE-2017-5715 | Spectre v2 | Indirect branch predictor |
| CVE-2017-5753 | Spectre v1 | Bounds check bypass |
| CVE-2022-29900 | Retbleed (AMD) | Return instruction speculation |
| CVE-2022-29901 | Retbleed (Intel) | Return instruction speculation |
| CVE-2023-20569 | Inception (AMD) | Return address speculation on Zen 3/4 |
| CVE-2022-26373 | Retbleed (Intel) | Return-based prediction |

---

## 8. The Story Behind Retbleed

The ETH Zurich researchers (Johannes Wikner and Kaveh Razavi) discovered that:

1. On AMD, `ret` instructions are predicted using a **perceptron** (not a
   simple table), making them vulnerable to sophisticated training attacks.
2. Retpoline, the standard Spectre-v2 mitigation, converts indirect jumps
   into `ret` instructions — **amplifying** the vulnerability on AMD.
3. The RSB can be poisoned through a **return address stack buffer
   speculation attack** (PBRSB), which is a variant of Retbleed.

The disclosure was coordinated with AMD, Intel, and the Linux kernel
security team.  Patches were merged in 5.19-rc7.

---

## 9. Further Reading

* **Retbleed paper: [retbleed.com](https://comsec.ethz.ch/retbleed/)**
* **LWN: [Retbleed](https://lwn.net/Articles/902433/)**
* **LWN: [Retbleed mitigations](https://lwn.net/Articles/903015/)**
* **AMD whitepaper: "Software Techniques for Managing Speculation"**
* **Intel whitepaper: "Retpoline: A Branch Target Injection Mitigation"**
* **Documentation: `Documentation/admin-guide/hw-vuln/retbleed.rst`**
* **Source: `arch/x86/kernel/cpu/bugs.c`**

---

## Cross-References

* [Spectre](./spectre.md) — the original speculative execution attack
* [Meltdown](./meltdown.md) — related kernel memory leak
* [KPTI](./kpti.md) — kernel page-table isolation
* [Branch Prediction](../arch/x86/branch-prediction.md) — CPU branch predictors
* [SMT/Hyperthreading](../arch/x86/smt.md) — related to speculation risks
* [Inception](./inception.md) — AMD-specific Retbleed variant
