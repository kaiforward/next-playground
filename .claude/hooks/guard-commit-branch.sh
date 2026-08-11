#!/usr/bin/env bash
# PreToolUse guard: git commits land only on feat/* branches.
# shared/* integration branches take sub-feature PR merges only; main takes PRs.
# Reads the hook payload from stdin; non-commit commands pass through untouched.

input=$(cat)

case "$input" in
  *"git commit"*) : ;;
  *) exit 0 ;;
esac

branch=$(git branch --show-current 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0  # detached HEAD or not a repo: not this guard's concern

case "$branch" in
  feat/*) exit 0 ;;
  *)
    echo "Blocked: 'git commit' on branch '$branch'. Commits land only on feat/* branches — shared/* integration branches take sub-feature PR merges only, and main takes PRs (AGENTS.md, Git Workflow). Branch off with: git switch -c feat/<name>" >&2
    exit 2
    ;;
esac
