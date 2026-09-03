'use client';

import { CircleHelp } from 'lucide-react';

import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

function ManualSection({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function UserManualDialog() {
  const { copy } = useAppPreferences();
  const { manual } = copy;

  return (
    <Dialog>
      <DialogTrigger
        render={<Button size="sm" variant="ghost" />}
        aria-label={copy.app.manual}
        title={copy.app.manual}
      >
        <CircleHelp data-icon="inline-start" />
        {copy.app.manual}
      </DialogTrigger>
      <DialogContent
        className="max-w-[min(42rem,calc(100%-2rem))] gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>{manual.title}</DialogTitle>
          <DialogDescription>{manual.description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(34rem,calc(100dvh-12rem))]">
          <div className="space-y-6 px-6 py-5 text-sm leading-6">
            <ManualSection
              title={manual.startTitle}
              items={manual.startSteps}
            />
            <ManualSection title={manual.editTitle} items={manual.editSteps} />
            <ManualSection
              title={manual.tableTitle}
              items={manual.tableSteps}
            />
            <ManualSection
              title={manual.exportTitle}
              items={manual.exportSteps}
            />
            <ManualSection
              title={manual.preferencesTitle}
              items={manual.preferencesSteps}
            />
            <ManualSection
              title={manual.projectTitle}
              items={manual.projectSteps}
            />
            <ManualSection
              title={manual.recoveryTitle}
              items={manual.recoverySteps}
            />
            <section className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <h3 className="font-semibold">{manual.privacyTitle}</h3>
              <p className="mt-1 text-muted-foreground">{manual.privacyText}</p>
            </section>
          </div>
        </ScrollArea>
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4">
          <DialogClose render={<Button variant="outline" />}>
            {copy.app.close}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
