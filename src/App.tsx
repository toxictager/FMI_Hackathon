import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ResultsPage from "./pages/Results";
import LandmarkPage from "./pages/Landmark";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/results" element={<ResultsPage />} />
      <Route path="/landmark/:slug" element={<LandmarkPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
