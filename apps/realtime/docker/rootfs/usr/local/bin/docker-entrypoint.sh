#!/bin/bash

cd /app/apps/realtime;
NODE_ENV=production NODE_OPTIONS=--no-node-snapshot HOSTNAME=${HOSTNAME:-0.0.0.0} PORT=${PORT:-1999} exec pnpm exec partykit dev --with-env;
