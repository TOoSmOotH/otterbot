import { useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold mb-4">{{APP_NAME}}</h1>
      <p className="text-gray-400 mb-8">Built with React + Vite + Tailwind CSS</p>
      <button
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg transition-colors"
        onClick={() => setCount((c) => c + 1)}
      >
        Count: {count}
      </button>
    </div>
  );
}

export default App;
