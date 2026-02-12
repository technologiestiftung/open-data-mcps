// ABOUTME: Generates Masterportal configuration files from session state
// ABOUTME: Produces config.json, config.js, services.json, and index.html using EPSG:25832

import proj4 from 'proj4';
import { PortalSession } from './types.js';

const MASTERPORTAL_VERSION = '3_10_0';

// Define projections - EPSG:25832 is UTM Zone 32N (Masterportal's default)
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Convert hex color to RGBA array for Masterportal
function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [228, 26, 28, alpha]; // Default red
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    alpha
  ];
}

// Darken a hex color for stroke
function darkenColor(hex: string): [number, number, number, number] {
  const rgba = hexToRgba(hex, 1);
  return [
    Math.max(0, rgba[0] - 68),
    Math.max(0, rgba[1] - 26),
    Math.max(0, rgba[2] - 28),
    1
  ];
}

// Extract feature type from WFS URL (last path segment)
function extractFeatureType(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(s => s.length > 0);
    return segments[segments.length - 1] || null;
  } catch {
    return null;
  }
}

export class PortalGenerator {
  generateConfigJson(session: PortalSession): string {
    // Convert WGS84 [lon, lat] to EPSG:25832 [x, y]
    const centerUTM = this.lonLatToUTM(session.mapConfig.center);

    // Minimal config matching working example structure
    const config = {
      portalConfig: {
        map: {
          controls: {
            zoom: true,
            orientation: {
              zoomMode: "once"
            }
          },
          mapView: {
            startCenter: centerUTM,
            startZoomLevel: session.mapConfig.zoom,
            // Germany-wide extent in EPSG:25832 to allow panning anywhere
            extent: [280000, 5200000, 920000, 6100000]
          }
        },
        mainMenu: {
          expanded: true,
          title: {
            text: session.mapConfig.title
          }
        },
        tree: {
          highlightedFeatures: {
            active: true
          }
        },
        searchBar: {
          searchInterfaces: [
            {
              type: "komootPhoton",
              minChars: 3,
              serviceId: "1",
              limit: 10,
              lang: "de",
              lat: 52.52,
              lon: 13.4,
              bbox: "13.0,52.3,13.8,52.7"
            }
          ]
        }
      },
      layerConfig: {
        baselayer: {
          elements: [
            {
              id: "basemap_de",
              visibility: true
            }
          ]
        },
        subjectlayer: {
          elements: session.layers.map(layer => ({
            id: layer.id,
            visibility: true,
            showInLayerTree: true
          }))
        }
      }
    };

    return JSON.stringify(config, null, 2);
  }

  generateConfigJs(_session: PortalSession): string {
    // Match working example structure - EPSG:25832 is Masterportal's default
    return `const Config = {
  namedProjections: [
    ["EPSG:25832", "+title=ETRS89/UTM 32N +proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"]
  ],
  layerConf: "./resources/services.json",
  restConf: "./resources/rest-services.json",
  styleConf: "./resources/style.json",
  portalLanguage: {
    enabled: true,
    debug: false,
    languages: {
      de: "Deutsch",
      en: "English"
    },
    fallbackLanguage: "de",
    changeLanguageOnStartWhen: ["querystring", "localStorage", "htmlTag"]
  }
};
`;
  }

  generateServicesJson(session: PortalSession): string {
    // German official basemap - supports EPSG:25832
    const basemap = {
      id: "basemap_de",
      name: "basemap.de Web Raster",
      url: "https://sgx.geodatenzentrum.de/wms_basemapde",
      typ: "WMS",
      layers: "de_basemapde_web_raster_farbe",
      format: "image/png",
      version: "1.3.0",
      singleTile: false,
      transparent: false,
      tilesize: 512,
      gutter: 0,
      gfiAttributes: "ignore",
      layerAttribution: "© basemap.de / BKG"
    };

    const layerServices = session.layers.map(layer => {
      if (layer.type === 'wfs') {
        return {
          id: layer.id,
          name: layer.name,
          url: layer.url,
          typ: "WFS",
          featureType: layer.featureType || extractFeatureType(layer.url) || layer.id,
          version: "2.0.0",
          styleId: `${layer.id}_style`,
          gfiAttributes: "showAll"
        };
      } else {
        return {
          id: layer.id,
          name: layer.name,
          url: `./data/${layer.id}.geojson`,
          typ: "GeoJSON",
          styleId: `${layer.id}_style`,
          gfiAttributes: "showAll"
        };
      }
    });

    return JSON.stringify([basemap, ...layerServices], null, 2);
  }

  generateRestServicesJson(): string {
    // Geocoding service for address search
    const restServices = [
      {
        id: "1",
        name: "Komoot Photon Suche",
        url: "https://photon.komoot.io/api/?",
        typ: "WFS"
      }
    ];
    return JSON.stringify(restServices, null, 2);
  }

  generateStyleJson(session: PortalSession): string {
    const styles = session.layers.map(layer => {
      const fillColor = hexToRgba(layer.style?.color || '#e41a1c', layer.style?.opacity ?? 0.8);
      const strokeColor = darkenColor(layer.style?.color || '#e41a1c');

      return {
        styleId: `${layer.id}_style`,
        rules: [
          {
            // Single rule with all geometry type styles - Masterportal auto-detects
            style: {
              // Point styles
              circleRadius: 8,
              circleFillColor: fillColor,
              circleStrokeColor: strokeColor,
              circleStrokeWidth: 2,
              // Polygon styles
              polygonFillColor: fillColor,
              polygonStrokeColor: strokeColor,
              polygonStrokeWidth: 2,
              // Line styles
              lineStrokeColor: fillColor,
              lineStrokeWidth: 4
            }
          }
        ]
      };
    });
    return JSON.stringify(styles, null, 2);
  }

  generateIndexHtml(session: PortalSession): string {
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=0">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <title>${session.mapConfig.title}</title>
  <link rel="stylesheet" href="./mastercode/${MASTERPORTAL_VERSION}/css/masterportal.css">
</head>
<body>
  <div id="masterportal-root"></div>
  <script type="text/javascript" src="./mastercode/${MASTERPORTAL_VERSION}/js/masterportal.js"></script>
</body>
</html>
`;
  }

  // Convert WGS84 [lon, lat] to EPSG:25832 (UTM Zone 32N)
  private lonLatToUTM(lonLat: [number, number]): [number, number] {
    const result = proj4('EPSG:4326', 'EPSG:25832', lonLat);
    return [Math.round(result[0]), Math.round(result[1])];
  }
}
