import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { buildCorrectionTemplate, type TemplateEnrollee } from "@/lib/correctionTemplate";
import type { DataQualityIssue } from "@/lib/types";

/** Enrollee lookups go out as .in() filters; keep the URL a sane length. */
const ID_CHUNK = 150;

/**
 * Download a pre-filled corrections CSV (see buildCorrectionTemplate) for the
 * open issues the caller can see: RLS on data_quality_issues and enrollee
 * scopes both to their country access. Honors ?country=.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");

  let issues: DataQualityIssue[];
  const enrollees = new Map<string, TemplateEnrollee>();
  try {
    issues = await fetchAllRows<DataQualityIssue>((from, to) => {
      let q = supabase.from("data_quality_issues").select("*").eq("status", "open").order("id");
      if (country) q = q.eq("country", country);
      return q.range(from, to);
    });

    const ids = [...new Set(issues.map((i) => i.uniqueid).filter((id): id is string => !!id))];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = await supabase
        .from("enrollee")
        .select("uniqueid,subjid,barcode,raw")
        .in("uniqueid", ids.slice(i, i + ID_CHUNK));
      if (error) throw new Error(error.message);
      for (const e of (data ?? []) as TemplateEnrollee[]) enrollees.set(e.uniqueid, e);
    }
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const csv = buildCorrectionTemplate(issues, enrollees);
  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(csv, `corrections_template_${country ?? "all"}_${date}.csv`);
}
