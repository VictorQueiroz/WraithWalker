export interface Theme {
  palette: {
    success:  (s: string) => string;
    error:    (s: string) => string;
    warn:     (s: string) => string;
    heading:  (s: string) => string;
    label:    (s: string) => string;
    muted:    (s: string) => string;
    accent:   (s: string) => string;
    usage:    (s: string) => string;
  };
  icons: {
    success: string;
    error:   string;
    warn:    string;
    bullet:  string;
  };
  indent: string;
  labelWidth: number;
}
