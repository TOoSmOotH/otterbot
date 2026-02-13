export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  mtime: string;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}
