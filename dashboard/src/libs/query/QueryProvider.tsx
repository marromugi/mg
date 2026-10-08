import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// Lets the parts inside call the API. Each place it is drawn keeps its
// own calls, so one page's never show in another's.
export const QueryProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
};
