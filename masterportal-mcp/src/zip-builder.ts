// ABOUTME: Bundles portal configs and Masterportal runtime into a downloadable zip
// ABOUTME: Manages download file lifecycle with expiration cleanup

import archiver from 'archiver';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { PortalSession, DownloadFile } from './types.js';
import { PortalGenerator } from './portal-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOAD_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export class ZipBuilder {
  private downloadsDir: string;
  private runtimeDir: string;
  private portalGenerator: PortalGenerator;
  private downloads: Map<string, DownloadFile> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.downloadsDir = join(__dirname, '..', 'downloads');
    this.runtimeDir = join(__dirname, '..', 'runtime', 'mastercode');
    this.portalGenerator = new PortalGenerator();

    // Ensure downloads directory exists
    if (!existsSync(this.downloadsDir)) {
      mkdirSync(this.downloadsDir, { recursive: true });
    }

    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupExpiredDownloads(), 5 * 60 * 1000);
  }

  async buildZip(session: PortalSession, customFilename?: string): Promise<DownloadFile> {
    const filename = customFilename
      ? `${customFilename.replace(/\.zip$/, '')}.zip`
      : `portal-${uuidv4().slice(0, 8)}.zip`;

    const zipPath = join(this.downloadsDir, filename);

    return new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        const downloadFile: DownloadFile = {
          filename,
          path: zipPath,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + DOWNLOAD_EXPIRY_MS),
        };
        this.downloads.set(filename, downloadFile);
        console.error(`Created zip: ${filename} (${archive.pointer()} bytes)`);
        resolve(downloadFile);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add generated config files
      archive.append(this.portalGenerator.generateIndexHtml(session), { name: 'index.html' });
      archive.append(this.portalGenerator.generateConfigJs(session), { name: 'config.js' });
      archive.append(this.portalGenerator.generateConfigJson(session), { name: 'config.json' });

      // Add resources
      archive.append(this.portalGenerator.generateServicesJson(session), { name: 'resources/services.json' });
      archive.append(this.portalGenerator.generateRestServicesJson(), { name: 'resources/rest-services.json' });
      archive.append(this.portalGenerator.generateStyleJson(session), { name: 'resources/style.json' });

      // Add GeoJSON data files for each layer
      for (const layer of session.layers) {
        if (layer.type === 'geojson' && layer.resolvedData) {
          archive.append(JSON.stringify(layer.resolvedData, null, 2), { name: `data/${layer.id}.geojson` });
        }
      }

      // Add Masterportal runtime if it exists
      if (existsSync(this.runtimeDir)) {
        archive.directory(this.runtimeDir, 'mastercode');
      } else {
        console.error('Warning: Masterportal runtime not found at', this.runtimeDir);
        // Add placeholder to indicate runtime needs to be added
        archive.append('# Masterportal runtime not bundled\nDownload from https://bitbucket.org/geowerkstatt-hamburg/masterportal/downloads/',
          { name: 'mastercode/README.md' });
      }

      archive.finalize();
    });
  }

  getDownload(filename: string): DownloadFile | undefined {
    return this.downloads.get(filename);
  }

  getDownloadPath(filename: string): string {
    return join(this.downloadsDir, filename);
  }

  private cleanupExpiredDownloads(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [filename, download] of this.downloads) {
      if (now > download.expiresAt.getTime()) {
        try {
          if (existsSync(download.path)) {
            unlinkSync(download.path);
          }
          this.downloads.delete(filename);
          cleaned++;
        } catch (error) {
          console.error(`Failed to cleanup ${filename}:`, error);
        }
      }
    }

    if (cleaned > 0) {
      console.error(`Cleaned up ${cleaned} expired downloads`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
