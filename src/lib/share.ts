// Plans can be opened from a link: #/import?plan=...&query=...&name=...
//
// The data lives in the URL fragment, which browsers never send to the server. Values are either plain
// (URI-encoded) text, or gzipped and base64-encoded in the *_gz parameters, which keeps links to big plans
// short enough to use, e.g. from a shell:
//
//   open "https://tatiyants.com/pev/#/import?plan_gz=$(gzip -c plan.json | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"

export interface ImportedPlan {
  plan: string;
  query: string;
  name: string;
}

export async function readImportParams(params: URLSearchParams): Promise<ImportedPlan> {
  const read = async (key: string) => {
    const zipped = params.get(`${key}_gz`);
    if (zipped) return gunzip(zipped);
    return params.get(key) ?? '';
  };
  return { plan: await read('plan'), query: await read('query'), name: params.get('name') ?? '' };
}

// a link that opens the plan in pev, relative to the page pev is served from
export async function buildImportUrl(base: string, { plan, query, name }: ImportedPlan): Promise<string> {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  params.set('plan_gz', await gzip(plan));
  if (query) params.set('query_gz', await gzip(query));
  return `${base}#/import?${params}`;
}

export async function gzip(text: string): Promise<string> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// accepts standard and URL-safe base64, with or without padding
export async function gunzip(encoded: string): Promise<string> {
  const base64 = encoded.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
