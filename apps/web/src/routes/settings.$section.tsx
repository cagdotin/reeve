import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { BankSettings } from "@/components/bank/bank-settings";
import { Page } from "@/components/page";
import { SectionSidebar } from "@/components/section-sidebar";
import { SectionHead } from "@/components/settings/section-head";
import {
  AppearanceSettings,
  Agents,
  BookSettingsList,
  GeneralSettings,
} from "@/components/settings/sections";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/settings-sections";

const SECTIONS: Record<SettingsSectionId, ComponentType> = {
  general: GeneralSettings,
  books: BookSettingsList,
  banks: BankSettings,
  appearance: AppearanceSettings,
  agents: Agents,
};

const sectionOf = (id: string) => SETTINGS_SECTIONS.find((section) => section.id === id);

export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params }) => {
    if (sectionOf(params.section) === undefined)
      throw redirect({ to: "/settings/$section", params: { section: "general" }, replace: true });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const params = Route.useParams();
  const section = sectionOf(params.section)!;
  const Section = SECTIONS[section.id];
  return (
    <Page title={section.label} width="window">
      <SectionSidebar />
      <SectionHead section={section} />
      <div className="flex flex-col divide-y pb-5">
        <Section key={section.id} />
      </div>
    </Page>
  );
}
