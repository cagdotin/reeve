import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { BookDialog } from "@/components/book-dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { booksQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { lastBook } from "@/lib/prefs";

/** The open book, the way to another, which reloads the app on it, and to Settings. */
export function BookSwitcher({
  trigger,
  children,
}: {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
}) {
  const { id, book } = useBook();
  const { data: books = [] } = useQuery(booksQuery);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const choose = (next: string) => {
    lastBook.set(next);
    void navigate({ to: "/", search: {}, reloadDocument: true });
  };
  return (
    <>
      <Menu>
        <MenuTrigger aria-label={`Book: ${book.settings.name}`} render={trigger}>
          {children}
        </MenuTrigger>
        <MenuPopup side="bottom" align="start" className="w-60 [&_svg]:size-3.5!">
          <MenuGroup>
            <MenuGroupLabel>Books</MenuGroupLabel>
            <MenuRadioGroup value={id} onValueChange={(next: string) => choose(next)}>
              {books.map((each) => (
                <MenuRadioItem key={each.id} value={each.id} closeOnClick>
                  <span className="min-w-0 truncate">{each.name}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            New book…
          </MenuItem>
          <MenuItem render={<Link to="/settings/$section" params={{ section: "general" }} />}>
            <SettingsIcon />
            Settings
            <MenuShortcut>S</MenuShortcut>
          </MenuItem>
        </MenuPopup>
      </Menu>
      <BookDialog open={creating} onOpenChange={setCreating} onCreated={(book) => choose(book)} />
    </>
  );
}
