export type Place = "home" | "harnesses" | "api-keys";

export type NavigationItem = {
  place: Place;
  href: string;
  label: string;
  state: "default" | "current";
};

const PLACES: { place: Place; href: string; label: string }[] = [
  { place: "home", href: "/", label: "ホーム" },
  { place: "harnesses", href: "/harnesses", label: "ハーネス" },
  { place: "api-keys", href: "/api-keys", label: "API キー" },
];

export const useNavigation = (current: Place): NavigationItem[] =>
  PLACES.map((item) => ({
    ...item,
    state: item.place === current ? "current" : "default",
  }));
