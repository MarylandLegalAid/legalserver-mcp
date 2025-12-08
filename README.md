# LegalServer MCP Server

This repository contains a standalone Model Context Protocol (MCP) server designed for integration with **LibreChat**. Its purpose is to provide LegalServer-specific tooling that allows LibreChat users—particularly legal aid staff—to interact with their LegalServer case data through natural-language tool calls.

## Overview

- Exposes MCP tools that wrap common LegalServer API operations.
- Intended for deployment alongside a LibreChat instance, but can also run independently as a Node.js service.
- Includes opinionated request filters appropriate for legal aid workflows.

## LegalServer API Documentation

The complete LegalServer API documentation (YAML format) is located in the `docs/` directory. These files serve as both reference material and the source of truth for all supported LegalServer endpoints.

## Usage

1. Install dependencies:
   ```bash
   npm install

2. Start the server:
   ```bash
   npm start
