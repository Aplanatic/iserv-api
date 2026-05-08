export interface GetWebDavClientOptions {
  davUrl?: string;
  username?: string;
  password?: string;
  path?: string;
}

export interface FolderSize {
  size: string;
}

export interface DiskSpaceEntry {
  label: string;
  size: string;
  color: string;
  sizeHuman: string;
}
