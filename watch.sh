#!/usr/bin/env bash

watchexec -r -i 'src/**,client/**' -- cargo run -- "$@"
