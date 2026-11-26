"use client";

import type { ReactNode } from "react";
import Sidebar, { MobileNavigation } from "../sidebar";
import type { Note } from "../model";

export default function LearningWorkspace({ notes, tags, children }: { notes: Note[]; tags: string[]; children: ReactNode }) {
  const navigation = <Sidebar notes={notes} tags={tags} view="learn"/>;
  return <div className="app-shell library-desk-shell">
    {navigation}
    <div className="workspace learn-workspace">
      <MobileNavigation>{navigation}</MobileNavigation>
      {children}
    </div>
  </div>;
}
