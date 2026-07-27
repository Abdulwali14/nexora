// OPTIONAL — deploy later for AI-written feedback text.
// The money is ALWAYS decided by submit_answer() in the database; this only
// adds a friendlier explanation. Deploy:  supabase functions deploy grade-task
// Set secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  try {
    const { prompt, body, answer } = await req.json();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content:
          `Task: ${prompt}\nContent: ${body}\nWorker answered: ${JSON.stringify(answer)}\n` +
          `In under 10 words, give friendly feedback on this answer.` }],
      }),
    });
    const d = await r.json();
    const text = (d.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return new Response(JSON.stringify({ feedback: text.trim() }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ feedback: "" }), { headers: { "content-type": "application/json" } });
  }
});
