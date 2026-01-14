-- Migration: Add missing notes column to properties table
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS notes TEXT;
