import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Plus } from 'lucide-react';

export default function BorrowerForm({ borrower, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    first_name: borrower?.first_name || '',
    last_name: borrower?.last_name || '',
    business: borrower?.business || '',
    phone: borrower?.phone || '',
    mobile: borrower?.mobile || '',
    landline: borrower?.landline || '',
    email: borrower?.email || '',
    contact_email: borrower?.contact_email || '',
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="first_name">First Name *</Label>
          <Input
            id="first_name"
            value={formData.first_name}
            onChange={(e) => handleChange('first_name', e.target.value)}
            placeholder="Enter first name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last_name">Last Name *</Label>
          <Input
            id="last_name"
            value={formData.last_name}
            onChange={(e) => handleChange('last_name', e.target.value)}
            placeholder="Enter last name"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="business">Business Name</Label>
        <Input
          id="business"
          value={formData.business}
          onChange={(e) => handleChange('business', e.target.value)}
          placeholder="Company or business name"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mobile">Mobile</Label>
          <Input
            id="mobile"
            value={formData.mobile}
            onChange={(e) => handleChange('mobile', e.target.value)}
            placeholder="Mobile number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="landline">Landline</Label>
          <Input
            id="landline"
            value={formData.landline}
            onChange={(e) => handleChange('landline', e.target.value)}
            placeholder="Landline number"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Primary Phone *</Label>
          <Input
            id="phone"
            value={formData.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="Primary contact number"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="email@example.com"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact_email">Contact Email (for grouping)</Label>
        <Input
          id="contact_email"
          type="email"
          value={formData.contact_email}
          onChange={(e) => handleChange('contact_email', e.target.value)}
          placeholder="Primary contact's email"
        />
        <p className="text-xs text-slate-500">
          Used to group multiple borrowers under the same contact person
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          value={formData.address}
          onChange={(e) => handleChange('address', e.target.value)}
          placeholder="Street address"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleChange('city', e.target.value)}
            placeholder="City"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zipcode">Postcode</Label>
          <Input
            id="zipcode"
            value={formData.zipcode}
            onChange={(e) => handleChange('zipcode', e.target.value)}
            placeholder="Postcode"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={formData.country}
            onChange={(e) => handleChange('country', e.target.value)}
            placeholder="Country"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="id_number">ID Number</Label>
          <Input
            id="id_number"
            value={formData.id_number}
            onChange={(e) => handleChange('id_number', e.target.value)}
            placeholder="National ID or Passport"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Blacklisted">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="keywords">Keywords</Label>
        <div className="flex gap-2">
          <Input
            id="keywords"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={handleKeywordKeyDown}
            placeholder="Add a keyword and press Enter"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={addKeyword}
            disabled={!newKeyword.trim()}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Keywords help find this borrower in searches (e.g., nickname, company alias)
        </p>
        {formData.keywords.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.keywords.map((keyword) => (
              <Badge
                key={keyword}
                variant="secondary"
                className="flex items-center gap-1 px-2 py-1"
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

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {borrower ? 'Update Borrower' : 'Add Borrower'}
        </Button>
      </div>
    </form>
  );
}