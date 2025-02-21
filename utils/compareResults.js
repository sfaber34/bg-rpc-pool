function compareResults(responseMap) {
  // First check if any response has an error status
  for (const [_, response] of responseMap) {
    if (response.status === 'error') {
      return "Error response";
    }
  }

  // Convert responseMap to array of responses
  const responses = Array.from(responseMap.entries()).map(([clientId, data]) => ({
    clientId,
    data: data.result // Extract just the result from the response data
  })).filter(r => r.data !== undefined); // Filter out any undefined results

  // If we don't have enough responses to compare, return null
  if (responses.length < 2) {
    return null;
  }

  // Helper function to deeply compare two values
  function deepCompare(val1, val2) {
    // Handle primitive types
    if (typeof val1 !== 'object' || val1 === null || typeof val2 !== 'object' || val2 === null) {
      return val1 === val2;
    }

    // For objects, compare common keys only
    const keys1 = Object.keys(val1);
    const keys2 = Object.keys(val2);
    const commonKeys = keys1.filter(key => keys2.includes(key));

    // Compare all common keys
    return commonKeys.every(key => deepCompare(val1[key], val2[key]));
  }

  // Compare each response with others and track matches
  const matches = new Map();

  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      const match = deepCompare(responses[i].data, responses[j].data);
      
      if (match) {
        matches.set(responses[i].clientId, (matches.get(responses[i].clientId) || 0) + 1);
        matches.set(responses[j].clientId, (matches.get(responses[j].clientId) || 0) + 1);
      }
    }
  }

  // Analyze matches
  if (matches.size === 0) {
    // All responses disagree
    return "All responses disagree";
  }

  // Check if all responses match
  if (Array.from(matches.values()).every(count => count === responses.length - 1)) {
    return true;
  }

  // Find the response that doesn't match (when two match and one differs)
  const mismatchedClient = responses.find(r => !matches.has(r.clientId) || matches.get(r.clientId) === 0);
  if (mismatchedClient) {
    return mismatchedClient.clientId;
  }

  // Fallback case
  return null;
}

module.exports = { compareResults };
