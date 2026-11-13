/**
 * Components a pack brings itself, by the names its definition uses. Most
 * packs need none: their views come from the shared blocks. Study keeps the
 * views it had before the engine.
 */
import type { ComponentType } from "react";
import { createSubject, StudyHomeSection, StudyView } from "../study/StudyViews";
import { TeacherAttendance } from "./views/TeacherAttendance";

/** Custom views and Home sections (ViewDef.component, PackDef.home). */
export const PACK_COMPONENTS: Record<string, ComponentType> = {
  "study.main": StudyView,
  "study.home": StudyHomeSection,
  "teacher.attendance": TeacherAttendance,
};

/**
 * Kinds that need their own way to be created (a subject asks for its colour
 * and timetable), by `<pack>.<kind id>`. Anything else is created from its
 * definition's starting values.
 */
export const PACK_CREATORS: Record<string, () => unknown> = {
  "study.subject": () => createSubject(),
};
