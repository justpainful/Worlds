import type { PackDef } from "../definition";

/**
 * Study, the first pack. It keeps the kinds and data keys it had before the
 * engine (subject, lesson, assignment, exam, requirement under metadata.<kind>),
 * so nothing a student already made moves. Its main view and Home section are
 * its own components; the fields below are what generic views and Claude see.
 */
export const STUDY: PackDef = {
  id: "study",
  family: "education",
  label: "Study",
  blurb: "Subjects, a class timetable, assignments, exams and lessons, for school or university.",
  icon: "graduation",
  adds: [
    "Subjects with teachers, rooms and colours",
    "A weekly class timetable in Calendar",
    "Assignments, exams and things to bring",
    "Lesson notes filed under each subject",
    "A study summary on Home",
  ],
  keywords: "subjects timetable homework exams دراسة مواد",
  kinds: [
    {
      id: "subject",
      kind: "subject",
      label: "Subject",
      plural: "Subjects",
      icon: "graduation",
      blurb: "A course, with its teacher, timetable and work",
      fields: [
        { id: "teacher", label: "Teacher", type: "text" },
        { id: "room", label: "Room", type: "text" },
        { id: "code", label: "Code", type: "text" },
        { id: "term", label: "Term", type: "text" },
      ],
    },
    {
      id: "lesson",
      kind: "lesson",
      label: "Lesson",
      plural: "Lessons",
      icon: "notebook",
      blurb: "Notes from one lesson",
      fields: [
        { id: "unit", label: "Unit", type: "text" },
        { id: "number", label: "Number", type: "number" },
        { id: "taughtOn", label: "Taught on", type: "date" },
      ],
      dateField: "taughtOn",
    },
    {
      id: "assignment",
      kind: "assignment",
      label: "Assignment",
      plural: "Assignments",
      icon: "clipboard",
      blurb: "Homework with a due date and a grade",
      fields: [
        { id: "due", label: "Due", type: "date" },
        { id: "time", label: "Time", type: "time" },
        { id: "points", label: "Points", type: "number" },
        { id: "earned", label: "Earned", type: "number" },
        { id: "submitted", label: "Handed in", type: "checkbox" },
        { id: "teacher", label: "Teacher", type: "text", detailOnly: true },
        { id: "instructions", label: "Instructions", type: "longText", detailOnly: true },
      ],
      dateField: "due",
      doneField: "submitted",
    },
    {
      id: "exam",
      kind: "exam",
      label: "Exam",
      plural: "Exams",
      icon: "medal",
      blurb: "A test, its scope and its result",
      fields: [
        { id: "date", label: "Date", type: "date" },
        { id: "time", label: "Time", type: "time" },
        { id: "location", label: "Location", type: "text" },
        { id: "maxScore", label: "Out of", type: "number" },
        { id: "score", label: "Score", type: "number" },
        { id: "scope", label: "Scope", type: "longText", detailOnly: true },
      ],
      dateField: "date",
    },
    {
      id: "requirement",
      kind: "requirement",
      label: "To bring",
      plural: "To bring",
      icon: "printer",
      blurb: "Something to bring, print or prepare",
      fields: [
        { id: "due", label: "Due", type: "date" },
        { id: "action", label: "What to do", type: "text" },
        { id: "ready", label: "Ready", type: "checkbox" },
        { id: "print", label: "Print", type: "checkbox", detailOnly: true },
        { id: "copies", label: "Copies", type: "number", detailOnly: true },
      ],
      dateField: "due",
      doneField: "ready",
    },
  ],
  views: [
    { id: "main", label: "Study", icon: "folder", type: "custom", component: "study.main" },
    { id: "grades", label: "Grades", icon: "table", type: "table", kind: "assignment", columns: ["due", "points", "earned", "submitted"] },
  ],
  sidebar: ["main"],
  home: "study.home",
  homeLink: "All subjects",
  newMenu: ["subject"],
  roles: [
    { id: "student", label: "Student", sees: "all", canEdit: true },
    { id: "classmate", label: "Classmate", sees: "all", canEdit: false },
  ],
};
