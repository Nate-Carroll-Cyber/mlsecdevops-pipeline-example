// Import the clsx utility for conditionally joining class names together
import { clsx, type ClassValue } from "clsx"
// Import twMerge to intelligently merge Tailwind CSS classes without style conflicts
import { twMerge } from "tailwind-merge"

// Export a utility function 'cn' (class names) that combines clsx and twMerge
export function cn(...inputs: ClassValue[]) {
  // First, resolve any conditional classes using clsx, then merge them using twMerge
  return twMerge(clsx(inputs))
}
