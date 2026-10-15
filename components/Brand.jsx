import Image from "next/image";

/** The Hathcocked Decks badge. `size` is the image's intrinsic resolution; CSS sets the shown size. */
export default function Brand({ size = 80, className = "brand" }) {
  return <Image src="/hathcocked-decks-logo.png" alt="Hathcocked Decks" width={size} height={size} priority className={className} />;
}

/** The page-header logo, top right, as in Hathcocked Recipes. */
export function HeaderBrand() {
  return <Brand size={112} className="brand" />;
}
