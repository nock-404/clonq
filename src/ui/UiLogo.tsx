import iconUrl from "../assets/brand/icon.png";
import markUrl from "../assets/brand/mark.svg";
import wordmarkUrl from "../assets/brand/wordmark.svg";

type Size = "xs" | "sm" | "md" | "lg";

interface UiLogoProps {
  /** "mark" is the reel alone, "wordmark" the reel with the name, "icon" the app icon with its body. */
  variant: "mark" | "wordmark" | "icon";
  size?: Size;
  /** Set when the logo stands for the app on its own; leave out when a text next to it names clonq already. */
  label?: string;
}

// Same scale as UiReel, so a mark sits in a list exactly where a reel would.
const sizes: Record<UiLogoProps["variant"], Record<Size, string>> = {
  mark: { xs: "size-5", sm: "size-7", md: "size-10", lg: "size-16" },
  // The wordmark is cropped to its ink (808 × 198); the height decides, the width follows.
  // object-left keeps it flush left when a column layout stretches the image box.
  wordmark: { xs: "h-4 w-auto object-contain object-left", sm: "h-5 w-auto object-contain object-left", md: "h-8 w-auto object-contain object-left", lg: "h-12 w-auto object-contain object-left" },
  icon: { xs: "size-8", sm: "size-12", md: "size-16", lg: "size-24" },
};

const sources: Record<UiLogoProps["variant"], string> = { mark: markUrl, wordmark: wordmarkUrl, icon: iconUrl };

/** The clonq logo. The artwork lives in src/assets/brand as files, so its gradients never clash with other SVGs on the page. */
export function UiLogo({ variant, size = "sm", label }: UiLogoProps) {
  return (
    <img
      src={sources[variant]}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`pointer-events-none shrink-0 select-none ${sizes[variant][size]}`}
    />
  );
}
