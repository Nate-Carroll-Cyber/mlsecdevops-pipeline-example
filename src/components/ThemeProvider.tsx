// Import React and NextThemesProvider
import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

// Export the ThemeProvider component that wraps its children with NextThemesProvider
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // Render the NextThemesProvider with the provided props and children
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
