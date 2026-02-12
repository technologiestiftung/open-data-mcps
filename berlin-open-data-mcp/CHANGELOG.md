# Changelog

All notable changes to the Berlin Open Data MCP Server.

## [3.0.0] - 2025-10-24

### Added - Phase 4 Part B: Excel Support
- Excel (XLS/XLSX) file parsing with xlsx library
- Binary download handling for Excel files
- Automatic first-sheet extraction with header detection
- Support for 545 datasets (20.6% of portal) with Excel files
- 30 Excel-only datasets now accessible

### Added - Phase 4 Part A: Browser Automation
- Optional Puppeteer integration for JavaScript-rendered downloads
- BrowserFetcher module for headless Chrome automation
- Automatic detection of statistik-berlin-brandenburg.de URLs
- Browser fallback when standard HTTP fetch fails
- Configuration option to enable/disable browser automation
- Support for 182 datasets (6.9% of portal) requiring JavaScript
- Improved error messages suggesting Puppeteer installation

### Added - Phase 4: Testing & Documentation
- Integration tests for Excel library
- Browser automation availability checks
- Updated README with Phase 4 features
- Installation instructions for optional Puppeteer
- Usage examples for Excel and browser automation
- Troubleshooting section for HTML-instead-of-CSV errors

### Improved
- DataFetcher now handles binary and text downloads appropriately
- Error messages explain why files can't be fetched and suggest solutions
- ABOUTME comments on all source files including new modules

## [2.0.0] - 2025-10-22

### Added - Phase 1: Portal Metadata & Navigation
- `get_portal_stats` tool for portal overview
- `list_all_datasets` tool with proper pagination
- Portal statistics API methods
- Enhanced pagination support

### Added - Phase 2: Data Fetching & Sampling
- `list_dataset_resources` tool to view available files
- `fetch_dataset_data` tool to download and parse data
- DataFetcher module for downloading CSV/JSON resources with papaparse
- DataSampler module for smart sampling and statistics
- Automatic format detection and conversion
- Column type inference and statistics
- Sample size limits to prevent context overflow
- Support for CSV and JSON formats with robust parsing

### Added - Phase 3: Documentation & Testing
- Integration test suite
- Comprehensive usage examples
- Updated README with new features
- CHANGELOG documentation

### Improved
- Error handling for network failures
- Error messages with actionable suggestions
- Type safety throughout codebase

### Fixed
- Corrected tool reference in `get_portal_stats` next steps

## [1.0.0] - 2025-10-22

### Initial Release
- Basic dataset search functionality
- Dataset details retrieval
- Category and organization listing
- Natural language query processing
- MCP protocol integration
