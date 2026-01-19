import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Plus } from 'lucide-react';

export default function BorrowerForm({ borrower, onSubmit, onCancel, isLoading, suggestedBorrowerNumber }) {
  const [formData, setFormData] = useState({
    first_name: borrower?.first_name || '',
    last_name: borrower?.last_name || '',
    business: borrower?.business || '',
    phone: borrower?.phone || '',
    mobile: borrower?.mobile || '',
    landline: borrower?.landline || '',
    email: borrower?.email || '',
    address: borrower?.address || '',
    city: borrower?.city || '',
    zipcode: borrower?.zipcode || '',
    country: borrower?.country || '',
    id_number: borrower?.id_number || '',
    status: borrower?.status || 'Active',
    keywords: borrower?.keywords || []
  });
  const [newKeyword, setNewKeyword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addKeyword = () => {
    const keyword = newKeyword.trim().toLowerCase();
    if (keyword && !formData.keywords.includes(keyword)) {
      setFormData(prev => ({
        ...prev,
        keywords: [...prev.keywords, keyword]
      }));
      setNewKeyword('');
    }
  };

  const removeKeyword = (keywordToRemove) => {
    setFormData(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keywordToRemove)
    }));
  };

  const handleKeywordKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  // Display the borrower number (existing or suggested for new)
  const displayBorrowerNumber = borrower?.unique_number || suggestedBorrowerNumber;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {displayBorrowerNumber && (
        <div className="space-y-1">
          <Label htmlFor="borrower_number" className="text-xs">Borrower Number</Label>
          <Input
            id="borrower_number"
            value={`#${displayBorrowerNumber}`}
            disabled
            className="bg-slate-50 text-slate-600 font-mono h-9"
          />
        </div>
      )}

      {/* Name Section */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="first_name" className="text-xs">First Name *</Label>
          <Input
            id="first_name"
            value={formData.first_name}
            onChange={(e) => handleChange('first_name', e.target.value)}
            placeholder="First name"
            required
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="last_name" className="text-xs">Last Name *</Label>
          <Input
            id="last_name"
            value={formData.last_name}
            onChange={(e) => handleChange('last_name', e.target.value)}
            placeholder="Last name"
            required
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="business" className="text-xs">Business Name</Label>
        <Input
          id="business"
          value={formData.business}
          onChange={(e) => handleChange('business', e.target.value)}
          placeholder="Company or business name"
          className="h-9"
        />
      </div>

      {/* Contact Section */}
      <div className="space-y-1">
        <Label htmlFor="phone" className="text-xs">Primary Phone *</Label>
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          placeholder="Primary contact number"
          required
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="mobile" className="text-xs">Mobile</Label>
          <Input
            id="mobile"
            value={formData.mobile}
            onChange={(e) => handleChange('mobile', e.target.value)}
            placeholder="Mobile"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="landline" className="text-xs">Landline</Label>
          <Input
            id="landline"
            value={formData.landline}
            onChange={(e) => handleChange('landline', e.target.value)}
            placeholder="Landline"
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="email" className="text-xs">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
          placeholder="email@example.com"
          className="h-9"
        />
      </div>

      {/* Address Section */}
      <div className="space-y-1">
        <Label htmlFor="address" className="text-xs">Address</Label>
        <Textarea
          id="address"
          value={formData.address}
          onChange={(e) => handleChange('address', e.target.value)}
          placeholder="Street address"
          rows={2}
          className="resize-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="city" className="text-xs">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleChange('city', e.target.value)}
            placeholder="City"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="zipcode" className="text-xs">Postcode</Label>
          <Input
            id="zipcode"
            value={formData.zipcode}
            onChange={(e) => handleChange('zipcode', e.target.value)}
            placeholder="Postcode"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="country" className="text-xs">Country</Label>
          <Input
            id="country"
            value={formData.country}
            onChange={(e) => handleChange('country', e.target.value)}
            placeholder="Country"
            className="h-9"
          />
        </div>
      </div>

      {/* ID & Status Section */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="id_number" className="text-xs">ID Number</Label>
          <Input
            id="id_number"
            value={formData.id_number}
            onChange={(e) => handleChange('id_number', e.target.value)}
            placeholder="ID or Passport"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="status" className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Blacklisted">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Keywords Section */}
      <div className="space-y-1">
        <Label htmlFor="keywords" className="text-xs">Keywords</Label>
        <div className="flex gap-2">
          <Input
            id="keywords"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={handleKeywordKeyDown}
            placeholder="Add keyword, press Enter"
            className="flex-1 h-9"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={addKeyword}
            disabled={!newKeyword.trim()}
            className="h-9 w-9"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {formData.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {formData.keywords.map((keyword) => (
              <Badge
                key={keyword}
                variant="secondary"
                className="flex items-center gap-1 px-2 py-0.5 text-xs"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  className="ml-1 hover:text-red-600 focus:outline-none"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {borrower ? 'Update' : 'Add Borrower'}
        </Button>
      </div>
    </form>
  );
}