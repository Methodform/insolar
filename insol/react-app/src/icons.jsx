// Иконки проекта — Heroicons (solid). Ре-экспорт под прежними именами, чтобы не менять места использования.
import React from 'react';
import {
  SunIcon as HSun, MoonIcon as HMoon, PlayIcon as HPlay, PauseIcon as HPause, PlusIcon as HPlus,
  PencilIcon as HPencil, ArrowsRightLeftIcon as HRuler, TrashIcon as HTrash, CheckIcon as HCheck,
  LockOpenIcon as HLock, Square3Stack3DIcon as HLayers, MapPinIcon as HPin, UserIcon as HUser,
  HomeIcon as HHome, DocumentTextIcon as HDoc, ArrowDownTrayIcon as HDown, ArrowUpTrayIcon as HUp,
  ArrowPathIcon as HReset, DocumentDuplicateIcon as HCopy, CalendarIcon as HCal,
  ChevronDoubleLeftIcon as HDDL, ChevronDoubleRightIcon as HDDR, ChevronDownIcon as HCDown,
  ChevronRightIcon as HCRight, ChevronLeftIcon as HCLeft, ClockIcon as HClock,
} from '@heroicons/react/24/solid';

const mk = Comp => function Icon(props) { return <Comp width={16} height={16} {...props} />; };

export const SunIcon = mk(HSun);
export const MoonIcon = mk(HMoon);
export const PlayIcon = mk(HPlay);
export const PauseIcon = mk(HPause);
export const PlusIcon = mk(HPlus);
export const Pencil1Icon = mk(HPencil);
export const RulerHorizontalIcon = mk(HRuler);
export const TrashIcon = mk(HTrash);
export const CheckIcon = mk(HCheck);
export const LockOpen1Icon = mk(HLock);
export const LayersIcon = mk(HLayers);
export const SewingPinFilledIcon = mk(HPin);
export const PersonIcon = mk(HUser);
export const HomeIcon = mk(HHome);
export const FileTextIcon = mk(HDoc);
export const DownloadIcon = mk(HDown);
export const UploadIcon = mk(HUp);
export const ResetIcon = mk(HReset);
export const CopyIcon = mk(HCopy);
export const CalendarIcon = mk(HCal);
export const DoubleArrowLeftIcon = mk(HDDL);
export const DoubleArrowRightIcon = mk(HDDR);
export const ChevronDownIcon = mk(HCDown);
export const ChevronRightIcon = mk(HCRight);
export const ChevronLeftIcon = mk(HCLeft);
export const CounterClockwiseClockIcon = mk(HClock);
