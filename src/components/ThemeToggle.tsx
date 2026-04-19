// Import React and icons
import * as React from "react"
import { Moon, Sun } from "lucide-react"
// Import useTheme hook from next-themes
import { useTheme } from "next-themes"
// Import Button component
import { Button } from "@/components/ui/button"

// Export the ThemeToggle component
export function ThemeToggle() {
  // Get the current theme and the function to set the theme
  const { theme, setTheme } = useTheme()

  // Render a button to toggle the theme
  return (
    <Button
      variant="outline"
      size="icon"
      className="rounded-none border-[#141414] dark:border-white h-7 w-7"
      // Toggle between light and dark themes on click
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      {/* Sun icon for light mode */}
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      {/* Moon icon for dark mode */}
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      {/* Screen reader text */}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
