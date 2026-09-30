// RFC 9110 §5.6.7: recipients must accept IMF-fixdate, and should
// accept the obsolete RFC 850 and asctime formats too.
const IMF_FIXDATE_PATTERN =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const RFC_850_DATE_PATTERN =
  /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), \d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/;

const ASCTIME_DATE_PATTERN =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/;

const parseHttpDate = (value: string): number => {
  if (
    IMF_FIXDATE_PATTERN.test(value) ||
    RFC_850_DATE_PATTERN.test(value)
  ) {
    return Date.parse(value);
  }
  // asctime carries no timezone; the format is always GMT.
  if (ASCTIME_DATE_PATTERN.test(value))
    return Date.parse(`${value} GMT`);
  return Number.NaN;
};

export const readRetryAfterMs = (
  value: string | null,
): number | undefined => {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const parsed = parseHttpDate(value);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - Date.now());
};
