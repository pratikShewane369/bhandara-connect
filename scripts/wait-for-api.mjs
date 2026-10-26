const port = Number(process.env.PORT || 4000);
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const deadline = Date.now() + 60_000;

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    if (response.ok) {
      console.log(`API ready at ${healthUrl}`);
      process.exit(0);
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}

console.error(`API did not become ready at ${healthUrl} within 60 seconds.`);
process.exit(1);
