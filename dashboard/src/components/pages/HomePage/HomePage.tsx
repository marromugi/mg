import { AppFrame } from "../../feature/AppFrame/index.js";
import { Heading } from "../../ui/index.js";

export const HomePage = () => (
  <AppFrame current="home">
    <Heading>ホーム</Heading>
    <p>ハーネスの管理と、API キーの登録ができます。</p>
  </AppFrame>
);
