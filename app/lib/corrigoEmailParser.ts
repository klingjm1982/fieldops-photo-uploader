export type ParsedCorrigoEmail = {
  accepted: boolean;
  reason: string;
  workOrderNumber: string;
  customerName: string;
  propertyName: string;
  siteAddress: string;
  problem: string;
  month: string;
};

function monthFromDateText(value: string) {
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";

  const month = Number(match[1]);
  const year = Number(match[3]);
  if (!month || !year) return "";

  return `${year}-${String(month).padStart(2, "0")}`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function lineValue(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function problemValue(text: string) {
  const lines = text.split(/\n+/).map((line) => line.trim());
  const problemIndex = lines.findIndex((line) => /^problem$/i.test(line));
  if (problemIndex >= 0) return lines[problemIndex + 1] ?? "";

  return lineValue(text, "Problem");
}

export function parseCorrigoWorkOrderEmail(subject: string, body: string): ParsedCorrigoEmail {
  const subjectMatch = subject.match(
    /^The new Scheduled work order #(\d+) received from Driven Brands$/i
  );
  const fallbackWorkOrder = body.match(/WORK ORDER\s+#(\d+)/i)?.[1] ?? "";
  const workOrderNumber = subjectMatch?.[1] ?? fallbackWorkOrder;
  const siteAddress = lineValue(body, "Site Address");
  const problem = problemValue(body);
  const dateCreated = lineValue(body, "Date Created");
  const month = monthFromDateText(dateCreated) || monthFromDateText(body) || currentMonth();
  const customerName = lineValue(body, "Name");
  const propertyName = body.match(/\n(\d+\s+-\s+[^\n]+)\n/)?.[1]?.trim() ?? "";

  if (!subjectMatch) {
    return {
      accepted: false,
      reason: "Subject is not a new Driven Brands scheduled work order.",
      workOrderNumber,
      customerName,
      propertyName,
      siteAddress,
      problem,
      month,
    };
  }

  if (!workOrderNumber) {
    return {
      accepted: false,
      reason: "Missing work order number.",
      workOrderNumber,
      customerName,
      propertyName,
      siteAddress,
      problem,
      month,
    };
  }

  if (!siteAddress) {
    return {
      accepted: false,
      reason: "Missing Site Address.",
      workOrderNumber,
      customerName,
      propertyName,
      siteAddress,
      problem,
      month,
    };
  }

  if (!/^landscape$/i.test(problem)) {
    return {
      accepted: false,
      reason: "Problem is not Landscape.",
      workOrderNumber,
      customerName,
      propertyName,
      siteAddress,
      problem,
      month,
    };
  }

  return {
    accepted: true,
    reason: "Accepted Corrigo Landscape work order.",
    workOrderNumber,
    customerName,
    propertyName,
    siteAddress,
    problem,
    month,
  };
}
