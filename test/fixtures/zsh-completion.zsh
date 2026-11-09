zmodload zsh/zpty
zmodload zsh/zselect
zpty -b completion zsh -df
trap 'zpty -d completion' EXIT
waitFor() {
  local output='' chunk
  until [[ $output == *$1* ]]; do
    if zpty -r completion chunk; then
      output+=$chunk
    else
      zselect -t 1
    fi
  done
  print -r -- "$output"
}
zpty -w completion 'fpath=("$MDVIEW_COMPLETIONS" $fpath); autoload -Uz compinit; compinit -D; autoload -Uz _mdview; compdef _mdview mdview; bindkey -e; cd "$MDVIEW_FIXTURE"; dumpBuffer() { print -r -- "RESULT:${BUFFER}"; BUFFER=""; zle reset-prompt; }; zle -N dumpBuffer; bindkey "^X" dumpBuffer; print -r -- BOOT_$((40+2))'
# A computed marker cannot be mistaken for the echoed setup command.
waitFor BOOT_42 > /dev/null
zpty -w -n completion $'mdview --wrap READ\t\x18'
waitFor 'RESULT:mdview --wrap README.md'
zpty -w -n completion $'mdview --wrap --th\t\x18'
waitFor 'RESULT:mdview --wrap --theme'
zpty -w -n completion $'mdview --config READ\t\x18'
waitFor 'RESULT:mdview --config README.md'
zpty -w -n completion $'mdview --theme dra\t\x18'
waitFor 'RESULT:mdview --theme dracula'
