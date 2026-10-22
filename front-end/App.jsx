import FileManager from "./FileManager";

export default function App() {
  return (
    <FileManager
      baseUrl="http://localhost:8080/api/files"
      // getToken={() => localStorage.getItem("token")} // aktifkan jika API memakai autentikasi
    />
  );
}
