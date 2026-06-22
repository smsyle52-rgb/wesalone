import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(cleanup)

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
})
