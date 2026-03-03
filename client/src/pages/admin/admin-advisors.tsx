import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Pencil, Trash2, Search, Shield, ExternalLink, FileText } from "lucide-react";
import type { User } from "@shared/schema";

type SafeUser = Omit<User, "password">;

export default function AdminAdvisors() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const [editForm, setEditForm] = useState({
    companyName: "",
    email: "",
    phone: "",
    sebiRegNumber: "",
    overview: "",
    role: "" as string,
  });

  const { data: users, isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, isApproved }: { id: string; isApproved: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, { isApproved });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
      setEditUser(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEdit = (user: SafeUser) => {
    setEditUser(user);
    setEditForm({
      companyName: user.companyName || "",
      email: user.email || "",
      phone: user.phone || "",
      sebiRegNumber: user.sebiRegNumber || "",
      overview: user.overview || "",
      role: user.role,
    });
  };

  const filtered = (users || []).filter((u) => {
    if (search && !u.username.toLowerCase().includes(search.toLowerCase()) && !(u.companyName || "").toLowerCase().includes(search.toLowerCase()) && !u.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    return true;
  });

  const advisors = filtered.filter((u) => u.role === "advisor");
  const investors = filtered.filter((u) => u.role === "investor");
  const admins = filtered.filter((u) => u.role === "admin");

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h1 className="text-xl font-bold" data-testid="admin-heading-users">User Management</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-56"
              data-testid="admin-input-search-users"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-32" data-testid="admin-filter-role">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="advisor">Advisors</SelectItem>
              <SelectItem value="investor">Investors</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          {(roleFilter === "all" || roleFilter === "advisor") && advisors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Advisors ({advisors.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {advisors.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onApprove={(approved) => approveMutation.mutate({ id: user.id, isApproved: approved })}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {(roleFilter === "all" || roleFilter === "investor") && investors.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Investors ({investors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {investors.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {(roleFilter === "all" || roleFilter === "admin") && admins.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Admins ({admins.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {admins.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onEdit={() => openEdit(user)}
                    onDelete={() => deleteMutation.mutate(user.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {filtered.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No users found
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User: {editUser?.username}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editUser) {
                updateMutation.mutate({ id: editUser.id, data: editForm });
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input
                value={editForm.companyName}
                onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                data-testid="admin-edit-company"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                data-testid="admin-edit-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                data-testid="admin-edit-phone"
              />
            </div>
            <div className="space-y-1.5">
              <Label>SEBI Registration Number</Label>
              <Input
                value={editForm.sebiRegNumber}
                onChange={(e) => setEditForm({ ...editForm, sebiRegNumber: e.target.value })}
                data-testid="admin-edit-sebi"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Overview</Label>
              <Textarea
                value={editForm.overview}
                onChange={(e) => setEditForm({ ...editForm, overview: e.target.value })}
                rows={3}
                data-testid="admin-edit-overview"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="admin-button-save-user">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserRow({
  user,
  onApprove,
  onEdit,
  onDelete,
}: {
  user: SafeUser;
  onApprove?: (approved: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-md bg-muted/50" data-testid={`admin-user-row-${user.id}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{user.companyName || user.username}</span>
          <Badge variant="outline" className="text-xs">{user.role}</Badge>
          {user.role === "advisor" && (
            user.isApproved ? (
              <Badge variant="secondary" className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">
                <CheckCircle className="w-3 h-3 mr-1" /> Approved
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                Pending Approval
              </Badge>
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground">{user.email}</p>
        {user.sebiRegNumber && (
          <p className="text-xs text-muted-foreground">SEBI: {user.sebiRegNumber}</p>
        )}
        {user.sebiCertUrl && (
          <a
            href={user.sebiCertUrl.startsWith("/objects/") ? user.sebiCertUrl : user.sebiCertUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary flex items-center gap-1"
            data-testid={`admin-cert-link-${user.id}`}
          >
            <FileText className="w-3 h-3" /> View SEBI Certificate
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {user.role === "advisor" && onApprove && (
          <>
            {!user.isApproved ? (
              <Button
                size="sm"
                onClick={() => onApprove(true)}
                data-testid={`admin-approve-${user.id}`}
              >
                <CheckCircle className="w-3 h-3 mr-1" /> Approve
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onApprove(false)}
                data-testid={`admin-disapprove-${user.id}`}
              >
                <XCircle className="w-3 h-3 mr-1" /> Disapprove
              </Button>
            )}
          </>
        )}
        <Button variant="outline" size="icon" onClick={onEdit} data-testid={`admin-edit-user-${user.id}`}>
          <Pencil className="w-3 h-3" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" data-testid={`admin-delete-user-${user.id}`}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete User?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {user.companyName || user.username} and all their data including strategies, calls, plans, and content. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} data-testid={`admin-confirm-delete-${user.id}`}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
