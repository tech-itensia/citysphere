import {
  AlertTriangle, BarChart3, Bell, Box, Building2, CalendarDays, Car, Check, ChevronRight, ClipboardList, Clock, CloudRain,
  Crosshair, Droplets, Gauge, Globe, Home, KeyRound, Layers, LayoutGrid, Leaf, Lightbulb, LogOut, Mail, MapPin, Maximize2,
  Megaphone, Minus, Navigation, Plane, Plus, Radio, Search, Send, Server, Settings, Shield, Siren, Sun, Trash2, Users, Wind,
  Wrench, X, Zap, Activity, RefreshCw, Camera, Filter, Cpu, Upload, Download, GitBranch, Link, Play, Pause, Power, Eye, Copy,
  FileText, ListChecks, Map, Route, Tag, Workflow, Building, Flag, Package, Database, Wifi, WifiOff, History, MessageSquare,
  Star, UserPlus, Lock, Sparkles, Monitor, Network, Thermometer, ArrowRight, ChevronDown, Minimize2, Info, Ban, Undo2,
} from "lucide-react";

const ICONS: Record<string, any> = {
  AlertTriangle, BarChart3, Bell, Box, Building2, CalendarDays, Car, Check, ChevronRight, ClipboardList, Clock, CloudRain,
  Crosshair, Droplets, Gauge, Globe, Home, KeyRound, Layers, LayoutGrid, Leaf, Lightbulb, LogOut, Mail, MapPin, Maximize2,
  Megaphone, Minus, Navigation, Plane, Plus, Radio, Search, Send, Server, Settings, Shield, Siren, Sun, Trash2, Users, Wind,
  Wrench, X, Zap, Activity, RefreshCw, Camera, Filter, Cpu, Upload, Download, GitBranch, Link, Play, Pause, Power, Eye, Copy,
  FileText, ListChecks, Map, Route, Tag, Workflow, Building, Flag, Package, Database, Wifi, WifiOff, History, MessageSquare,
  Star, UserPlus, Lock, Sparkles, Monitor, Network, Thermometer, ArrowRight, ChevronDown, Minimize2, Info, Ban, Undo2,
};

export function Icon({ name, size = 18, color, strokeWidth = 2 }: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  const C = ICONS[name] ?? Box;
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
}
