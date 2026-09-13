"""
Framework adapters (Section 2).

``ollama_adapter`` and ``openai_compatible_adapter`` are real, working HTTP
clients (using ``requests`` to keep the dependency list minimal). The
LangGraph / LangChain / CrewAI / MCP adapters are documented integration
points that activate automatically once the corresponding optional package
is installed -- see each module's docstring.
"""

from acbe.adapters.crewai_adapter import CrewAIAdapter
from acbe.adapters.gemini_adapter import GeminiAdapter
from acbe.adapters.langchain_adapter import LangChainAdapter
from acbe.adapters.langgraph_adapter import LangGraphAdapter
from acbe.adapters.mcp_adapter import MCPAdapter
from acbe.adapters.ollama_adapter import OllamaAdapter
from acbe.adapters.openai_compatible_adapter import OpenAICompatibleAdapter

__all__ = [
    "GeminiAdapter",
    "OllamaAdapter",
    "OpenAICompatibleAdapter",
    "LangGraphAdapter",
    "LangChainAdapter",
    "CrewAIAdapter",
    "MCPAdapter",
]
