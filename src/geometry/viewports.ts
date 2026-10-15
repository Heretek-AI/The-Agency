export interface ViewportDefinition {
  name: "mobile" | "tablet" | "desktop" | "wide" | string
  width: number
  height: number
  deviceScaleFactor?: number
  isMobile?: boolean
}

export const STANDARD_VIEWPORTS: Record<string, ViewportDefinition> = {
  mobile: {
    name: "mobile",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
    isMobile: true,
  },
  tablet: {
    name: "tablet",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
  },
  desktop: {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    isMobile: false,
  },
  wide: {
    name: "wide",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
  },
}
