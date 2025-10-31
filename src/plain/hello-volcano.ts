import { agent, llmOpenAI } from "volcano-sdk";

const llm = llmOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
});

const results = await agent({ llm })
  .then({ prompt: "Tell me about Club Nacional de Futbol from Uruguay" })
  .run();

console.log(results[0].llmOutput);
// Output: "Hello Marco! Hope you're having a great day!"