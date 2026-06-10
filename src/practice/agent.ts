type agent={
    name:string,
    userQuestion:string,
    status:"error" | "success" |"timeout",
    model:"gpt-3.5" | "gpt-4",
    inputTokens:number,
    outputTokens:number,
    steps:string[],
};
let agent1:agent={
    name:"Agent 1",
    userQuestion:"What is the capital of France?",
    status:"success",
    model:"gpt-3.5",
    inputTokens:10,
    outputTokens:20,
    steps:["Step 1: Analyze the question", "Step 2: Search for the answer", "Step 3: Provide the answer"]
};
console.log(agent1);