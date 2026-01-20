#!/usr/bin/env bash
set -euo pipefail

# Multi-instance dev helper.
#
# If your folder name ends with "-<N>" (e.g. "craft-agents-oss-1"),
# we derive instance-scoped config + ports so you can run multiple dev copies.
#
# This script is sourced by `bun run electron:dev`:
#   source scripts/detect-instance.sh && ...
#
# It should be safe to run even if you don't use multi-instance.

_cwd_base="$(basename "$PWD")"

# Match trailing "-<number>"
if [[ "$_cwd_base" =~ -([0-9]+)$ ]]; then
  _instance="${BASH_REMATCH[1]}"
else
  _instance=""
fi

# Respect explicit env overrides if user already set them
if [[ -n "${_instance}" ]]; then
  if [[ -z "${CRAFT_INSTANCE_NUMBER:-}" ]]; then
    export CRAFT_INSTANCE_NUMBER="$_instance"
  fi

  if [[ -z "${CRAFT_CONFIG_DIR:-}" ]]; then
    export CRAFT_CONFIG_DIR="$HOME/.craft-agent-${CRAFT_INSTANCE_NUMBER}"
  fi

  if [[ -z "${CRAFT_APP_NAME:-}" ]]; then
    export CRAFT_APP_NAME="Craft Agents [${CRAFT_INSTANCE_NUMBER}]"
  fi

  if [[ -z "${CRAFT_DEEPLINK_SCHEME:-}" ]]; then
    export CRAFT_DEEPLINK_SCHEME="craftagents${CRAFT_INSTANCE_NUMBER}"
  fi

  # Avoid port conflicts across instances
  if [[ -z "${CRAFT_VITE_PORT:-}" ]]; then
    export CRAFT_VITE_PORT="$((5173 + CRAFT_INSTANCE_NUMBER))"
  fi
fi

