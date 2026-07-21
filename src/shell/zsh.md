# Zsh (Z Shell)

## Introduction

Zsh (Z Shell) is an extended Bourne shell with many improvements over Bash: better tab completion, spell correction, themeable prompts, plugin architecture, and numerous small conveniences. It's the default shell on macOS (since Catalina) and is popular among developers for its productivity features.

## Key Features

### Superior Tab Completion

Zsh's completion system is its most celebrated feature:

```bash
# Basic completion
ls /u/l/b<TAB>
# Completes to /usr/local/bin/

# Partial completion
cd /u/lo/b<TAB>
# Completes to /usr/local/bin/

# Menu selection
cd <TAB>
# Shows interactive menu of directories

# Completion for commands
git ch<TAB>
# checkout  cherry-pick  cherry

# Completion with descriptions
git checkout <TAB>
# --conflict  -- style to use for conflicting hunks
# --detach    -- detach HEAD at named commit
# -f          -- force
```

### Configuration

```bash
# ~/.zshrc - Main configuration file

# History configuration
HISTFILE=~/.zsh_history
HISTSIZE=100000
SAVEHIST=100000
setopt HIST_IGNORE_DUPS       # Don't record duplicates
setopt HIST_IGNORE_SPACE      # Don't record lines starting with space
setopt HIST_FIND_NO_DUPS      # Don't show duplicates in search
setopt SHARE_HISTORY          # Share history between sessions
setopt EXTENDED_HISTORY       # Record timestamp

# Directory navigation
setopt AUTO_CD                # Type directory name to cd
setopt AUTO_PUSHD             # cd pushes to directory stack
setopt PUSHD_IGNORE_DUPS      # Don't push duplicates
setopt CDABLE_VARS            # cd to named directories

# Input/output
setopt CORRECT                # Spell correction for commands
setopt CORRECT_ALL            # Spell correction for arguments
setopt INTERACTIVE_COMMENTS   # Allow # comments in interactive shell
setopt NO_BEEP                # No beeps
```

## Oh My Zsh

Oh My Zsh is a framework for managing Zsh configuration:

### Installation

```bash
# Via curl
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

# Via wget
sh -c "$(wget https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh -O -)"

# Via package manager (some distros)
sudo apt install oh-my-zsh  # Not always available
```

### Directory Structure

```
~/.oh-my-zsh/
├── lib/              # Core functions
├── plugins/          # Bundled plugins
├── themes/           # Bundled themes
├── custom/           # User customizations
│   ├── plugins/      # Custom plugins
│   └── themes/       # Custom themes
└── templates/        # Templates
```

### Configuration

```bash
# ~/.zshrc with Oh My Zsh
export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="robbyrussell"  # or "agnoster", "powerlevel10k", etc.

plugins=(
    git
    docker
    kubectl
    zsh-autosuggestions
    zsh-syntax-highlighting
    zsh-completions
    history-substring-search
)

source $ZSH/oh-my-zsh.sh
```

## Popular Plugins

### Built-in Plugins

```bash
# Git aliases and functions
plugins=(git)
# Provides: gst, gco, gp, gl, gd, ga, gc, gb, etc.
# gco main    → git checkout main
# gst         → git status
# gcmsg "msg" → git commit -m "msg"

# Docker completion
plugins=(docker)
# docker <TAB> → full subcommand completion
# docker run <TAB> → image completion

# kubectl completion
plugins=(kubectl)
# kubectl get <TAB> → resource type completion
# kubectl get pods <TAB> → pod name completion

# History search
plugins=(history-substring-search)
# Use up/down arrows to search history with partial input
```

### External Plugins

```bash
# Install zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-autosuggestions \
    ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions

# Install zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-syntax-highlighting \
    ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Install zsh-completions
git clone https://github.com/zsh-users/zsh-completions \
    ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-completions

# Add to .zshrc
plugins=(git zsh-autosuggestions zsh-syntax-highlighting zsh-completions)
```

### zsh-autosuggestions

Shows ghost text suggestions from history as you type:

```bash
# Accept suggestion: → (right arrow) or End
# Accept one word: Alt+F or Ctrl+→
# Clear suggestion: Esc

# Configuration
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=8"  # Dim gray
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=20
```

### zsh-syntax-highlighting

Real-time syntax highlighting:

```bash
# Commands are green
ls /tmp

# Unknown commands are red
nonexistent_command

# Strings are yellow
echo "hello world"

# Errors highlighted
echo "unterminated

# Configuration types
# main     - default
# brackets - matching brackets
# pattern  - pattern-based
# cursor   - cursor line
# line     - entire line
```

## Themes

### Powerlevel10k

The most popular Zsh theme:

```bash
# Install
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git \
    ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k

# Set in .zshrc
ZSH_THEME="powerlevel10k/powerlevel10k"

# Run configuration wizard
p10k configure
```

### Theme Comparison

| Theme | Features | Speed |
|---|---|---|
| robbyrussell | Minimal, default | Fast |
| agnoster | Powerline, git info | Fast |
| powerlevel10k | Highly configurable, instant prompt | Fast |
| spaceship | Modular, many segments | Moderate |
| starship | Cross-shell, Rust-based | Fast |

### Custom Prompt

```bash
# Simple custom prompt
PROMPT='%F{green}%n@%m%f:%F{blue}%~%f$ '

# With git info
autoload -Uz vcs_info
precmd() { vcs_info }
zstyle ':vcs_info:git:*' formats '(%b)'
PROMPT='%F{green}%n%f:%F{blue}%~%f%F{yellow}${vcs_info_msg_0_}%f$ '

# Right prompt
RPROMPT='%F{gray}%D{%H:%M}%f'
```

## Vi Mode

Zsh has excellent vi mode support:

```bash
# Enable vi mode
bindkey -v

# Key timeout (for mode switching)
KEYTIMEOUT=1  # 10ms (default is 40ms)

# Vi mode status indicator
function zle-keymap-select {
    case $KEYMAP in
        vicmd) PROMPT='%F{blue} NORMAL%f $ ' ;;
        viins) PROMPT='%F{green} INSERT%f $ ' ;;
    esac
    zle reset-prompt
}
zle -N zle-keymap-select

# Useful bindings in insert mode
bindkey '^A' beginning-of-line
bindkey '^E' end-of-line
bindkey '^K' kill-line
bindkey '^R' history-incremental-search-backward
bindkey '^P' up-history
bindkey '^N' down-history

# Text objects (vi mode)
autoload -Uz select-bracketed select-quoted
zle -N select-bracketed
zle -N select-quoted
for m in viopp visual; do
    for c in {a,i}${(s..)^:-'()[]{}<>bB'}; do
        bindkey -M $m $c select-bracketed
    done
    for c in {a,i}{\',\",\`}; do
        bindkey -M $m $c select-quoted
    done
done
```

## Completion System

### Configuration

```bash
# Initialize completion system
autoload -Uz compinit
compinit -u  # -u: skip security check (faster)

# Completion styling
zstyle ':completion:*' menu select                    # Menu selection
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'  # Case insensitive
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' group-name ''                  # Group by category
zstyle ':completion:*:descriptions' format '%F{yellow}-- %d --%f'
zstyle ':completion:*:warnings' format '%F{red}No matches%f'

# Completion caching
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path ~/.zsh/cache

# Kill process completion
zstyle ':completion:*:*:kill:*:processes' list-colors '=(#b) #([0-9]#)*=0=01;31'
zstyle ':completion:*:*:kill:*' menu yes select
zstyle ':completion:*:*:killall:*' menu yes select
```

### Custom Completion

```bash
# Define completion for a custom command
_mycommand() {
    local -a subcommands
    subcommands=(
        'start:Start the service'
        'stop:Stop the service'
        'restart:Restart the service'
        'status:Show service status'
    )

    _arguments \
        '1:command:->subcmds' \
        '2:arg:->args'

    case $state in
        subcmds) _describe 'command' subcommands ;;
        args)
            case $words[2] in
                start) _files ;;
                stop)  _pids ;;
            esac
    esac
}
compdef _mycommand mycommand
```

## History Features

```bash
# History search with arrows
bindkey '^[[A' history-search-backward   # Up arrow
bindkey '^[[B' history-search-forward    # Down arrow

# History substring search (with plugin)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

# Incremental search
bindkey '^R' history-incremental-search-backward

# History options
setopt HIST_IGNORE_ALL_DUPS    # Remove older duplicates
setopt HIST_REDUCE_BLANKS      # Remove leading/trailing spaces
setopt HIST_VERIFY             # Show command before executing
setopt INC_APPEND_HISTORY      # Write immediately, not on exit
```

## Useful Zsh Features

### Glob Qualifiers

```bash
# Files modified in last 24 hours
ls *(m-1)

# Files larger than 1MB
ls *(Lk+1000)

# Only regular files
ls *(.)

# Only directories
ls *(/)

# Symbolic links
ls *(@)

# Executable files
ls *(*)

# Empty files
ls *(L0)

# Sort by modification time
ls *(om)     # Newest first
ls *(Om)     # Oldest first

# Limit results
ls *(.[5])   # First 5 files
ls *(-5)     # Last 5 files
```

### Parameter Expansion

```bash
# Uppercase/lowercase
str="Hello World"
echo ${str:u}      # HELLO WORLD
echo ${str:l}      # hello world
echo ${str:u:0:1}  # H (first char uppercase)

# String length
echo ${#str}       # 11

# Array operations
arr=(one two three)
echo ${#arr[@]}    # 3
echo ${arr[-1]}    # three (last element)
echo ${arr[2,-2]}  # two (slice)

# Default values
echo ${var:-default}    # Use default if unset
echo ${var:=default}    # Assign default if unset
echo ${var:+alternate}  # Use alternate if set
```

### Named Directories

```bash
# Create named directory
hash -d projects=~/Documents/projects
hash -d downloads=~/Downloads

# Now you can use
cd ~projects
# or
ls ~downloads

# In prompts
PROMPT='%~$ '  # Shows named dirs as ~name
```

## Zsh vs Bash

| Feature | Zsh | Bash |
|---|---|---|
| Tab completion | Superior, built-in | Good, with bash-completion |
| Autosuggestions | Plugin | Plugin |
| Spell correction | Built-in | ❌ |
| Glob qualifiers | `*(.)`, `*(m-1)` | ❌ |
| Recursive glob | `**/*.txt` | `shopt -s globstar` |
| Arrays | 1-indexed | 0-indexed |
| Associative arrays | ✅ | ✅ (Bash 4+) |
| Prompt themes | Oh My Zsh, p10k | Limited |
| Startup speed | ~80ms | ~40ms |
| Default on | macOS | Most Linux |

## Performance Optimization

```bash
# Lazy-load heavy plugins
zinit light zsh-users/zsh-autosuggestions

# Compile zsh files
zcompile ~/.zshrc
zcompile ~/.zsh_history

# Use turbo mode (zinit)
zinit ice wait lucid
zinit light zsh-users/zsh-syntax-highlighting

# Profile startup
time zsh -i -c exit
```

## References

- [Zsh Documentation](https://zsh.sourceforge.io/Doc/)
- [Oh My Zsh](https://ohmyz.sh/)
- [Zsh Users Guide](https://zsh.sourceforge.io/Guide/)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
- [Zsh Plugin Standard](https://zdharma-continuum.github.io/Zsh-Plugin-Standard/)

## Related Topics

- [Shell Overview](./overview.md) — shell types and fundamentals
- [Fish](./fish.md) — alternative modern shell
- [POSIX Shell](./posix-shell.md) — portable scripting
