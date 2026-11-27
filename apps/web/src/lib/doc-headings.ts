import { Children, isValidElement, type ReactNode } from "react";

export const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "";
    })
    .join("");

/** The anchor a heading gets, as GitHub writes it. */
export const headingId = (children: ReactNode) =>
  textOf(children)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
