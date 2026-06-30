// Public surface of the database schema. drizzle.config.ts globs the directory,
// but app code imports tables from here so the import seam stays stable.
export * from "./orgs";
export * from "./users";
export * from "./leads";
