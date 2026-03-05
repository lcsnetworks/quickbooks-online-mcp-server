#!/bin/bash
set -e

cd /home/joel/Downloads/quickbooks-online-mcp-server

echo "Installing dependencies..."
npm install

echo "Verifying build..."
npm run build

echo "Init complete."
