// ABOUTME: Downloads files from JavaScript-rendered pages using headless browser
// ABOUTME: Handles Single Page Applications that don't support direct file downloads

import puppeteer, { Browser, Page } from 'puppeteer';

export interface BrowserFetchResult {
  success: boolean;
  data?: string;
  error?: string;
}

export class BrowserFetcher {
  private browser: Browser | null = null;
  private readonly DOWNLOAD_TIMEOUT = 30000; // 30 seconds for browser operations (reduced from 60)

  async initialize(): Promise<void> {
    if (!this.browser) {
      console.error('[Browser] Launching headless browser...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-features=DownloadBubble,DownloadBubbleV2' // Disable download UI
        ],
      });
    }
  }

  async fetchWithBrowser(url: string): Promise<BrowserFetchResult> {
    let page: Page | null = null;

    try {
      console.error('[Browser] Starting browser automation for:', url);
      await this.initialize();

      page = await this.browser!.newPage();

      // Prevent actual file downloads to disk - we only want to capture the URL and fetch data in memory
      const client = await page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'deny'
      });

      // Strategy: Capture the download URL from network traffic, then fetch it directly
      let downloadUrl: string | null = null;
      const downloadUrlPromise = new Promise<string | null>((resolve) => {
        let resolved = false;

        page!.on('response', async (response) => {
          if (resolved) return;

          const responseUrl = response.url();

          // Look for the actual CSV download URL from the download subdomain
          if (responseUrl.includes('download.statistik-berlin-brandenburg.de') &&
              responseUrl.endsWith('.csv') &&
              response.status() === 200) {
            console.error('[Browser] Found download URL:', responseUrl);
            resolved = true;
            resolve(responseUrl);
          }
        });

        // Timeout after waiting period (reduced from 20s to 15s)
        setTimeout(() => {
          if (!resolved) {
            console.error('[Browser] Timeout waiting for download URL');
            resolved = true;
            resolve(null);
          }
        }, 15000);
      });

      // Navigate to the URL to trigger the SPA
      console.error('[Browser] Navigating to page...');
      try {
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: this.DOWNLOAD_TIMEOUT
        });
      } catch (navError) {
        // Navigation might timeout, but we may have captured the download URL
        console.error('[Browser] Navigation timeout (expected for SPAs)');
      }

      // Wait for download URL to be captured
      downloadUrl = await downloadUrlPromise;

      console.error('[Browser] Closing page...');
      await page.close();
      page = null;

      // If we found the download URL, fetch it directly
      if (downloadUrl) {
        try {
          console.error('[Browser] Downloading CSV from captured URL...');
          const fetch = (await import('node-fetch')).default;
          const response = await fetch(downloadUrl);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const text = await response.text();
          console.error(`[Browser] Downloaded ${text.length} characters`);

          // Verify it's CSV data
          const trimmed = text.trim();
          if (!trimmed.toLowerCase().startsWith('<!doctype') &&
              !trimmed.toLowerCase().startsWith('<html') &&
              trimmed.length > 0 &&
              (trimmed.includes(',') || trimmed.includes(';'))) {
            console.error('[Browser] CSV download successful');
            return {
              success: true,
              data: text,
            };
          }
        } catch (fetchError) {
          console.error('[Browser] Download failed:', fetchError);
          return {
            success: false,
            error: `Found download URL but could not fetch: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
          };
        }
      }

      console.error('[Browser] Failed to capture download URL');
      return {
        success: false,
        error: 'Could not capture download URL from JavaScript-rendered page.',
      };

    } catch (error) {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // Check if Puppeteer is available
  static isAvailable(): boolean {
    try {
      // In ES module context, try importing to check availability
      // We check if the module can be resolved without actually importing
      import.meta.resolve?.('puppeteer');
      return true;
    } catch {
      // Fallback: puppeteer is a dependency, so if we got here, it's available
      // The import at the top of this file would have failed if puppeteer wasn't installed
      return true;
    }
  }
}
